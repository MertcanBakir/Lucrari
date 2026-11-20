-- Simplified portfolio: moving weighted average cost and optional manual cash.
-- Historical migrations remain immutable; this migration removes obsolete live objects.
begin;
set local lock_timeout = '10s';
lock table public.portfolios, public.portfolio_transactions, public.portfolio_cash_accounts,
 public.portfolio_cash_flows, public.portfolio_fifo_matches in access exclusive mode;

-- Freeze the actual current cash before removing the ledger.
update public.portfolio_cash_accounts a
set opening_balance = private.get_portfolio_cash_balance(a.portfolio_id, a.currency);

-- Remove automatic cash setup for new portfolios.
do $$ declare r record; begin
 for r in select t.tgname from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.portfolios'::regclass and p.proname='initialize_new_portfolio_cash_accounts'
 loop execute format('drop trigger %I on public.portfolios', r.tgname); end loop;
end $$;


create or replace function private.get_portfolio_position_summary_at(
 p_portfolio_id uuid, p_instrument_id uuid, p_cutoff timestamptz)
returns table(current_quantity numeric, remaining_cost_basis numeric, realized_pnl numeric)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare t record; sold_cost numeric;
begin
 current_quantity := 0; remaining_cost_basis := 0; realized_pnl := 0;
 for t in select * from public.portfolio_transactions
 where portfolio_id=p_portfolio_id and instrument_id=p_instrument_id
 and not is_reversed and transaction_at <= p_cutoff
 order by transaction_at, created_at, id
 loop
  if t.transaction_type='BUY' then
   current_quantity := current_quantity + t.quantity;
   remaining_cost_basis := remaining_cost_basis + t.quantity*t.unit_price;
  else
   if t.quantity > current_quantity then
    raise exception using errcode='P0001', message='portfolio_insufficient_position';
   end if;
   sold_cost := remaining_cost_basis*t.quantity/current_quantity;
   realized_pnl := realized_pnl + t.quantity*t.unit_price - sold_cost;
   remaining_cost_basis := remaining_cost_basis - sold_cost;
   current_quantity := current_quantity - t.quantity;
   if current_quantity=0 then remaining_cost_basis := 0; end if;
  end if;
 end loop;
 return next;
end $$;
create or replace function private.get_portfolio_position_summary(p_portfolio_id uuid, p_instrument_id uuid)
returns table(current_quantity numeric, remaining_cost_basis numeric, realized_pnl numeric)
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select * from private.get_portfolio_position_summary_at(p_portfolio_id,p_instrument_id,'infinity'::timestamptz);
$$;


CREATE OR REPLACE FUNCTION public.record_portfolio_transaction(p_portfolio_id uuid, p_instrument_id uuid, p_transaction_type text, p_quantity numeric, p_unit_price numeric, p_transaction_currency text, p_transaction_at timestamp with time zone, p_client_request_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_transaction_type text := upper(btrim(coalesce(p_transaction_type, '')));
    v_currency text := upper(btrim(coalesce(p_transaction_currency, '')));
    v_notes text := nullif(btrim(p_notes), '');
    v_payload jsonb;
    v_claim record;
    v_instrument record;
    v_transaction_id uuid;
    v_current_quantity numeric;
    v_remaining_cost_basis numeric;
    v_realized_pnl numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_transaction_type not in ('BUY', 'SELL') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_transaction_type';
    end if;
    if p_quantity is null or p_quantity <= 0
       or p_quantity in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_quantity';
    end if;
    if p_unit_price is null or p_unit_price <= 0
       or p_unit_price in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_unit_price';
    end if;
    if v_currency not in ('TRY', 'USD') then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_currency';
    end if;
    if p_transaction_at is null then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_at_required';
    end if;
    if p_transaction_at > now() + interval '5 minutes' then
        raise exception using errcode = 'P0001', message = 'portfolio_future_transaction_not_allowed';
    end if;

    -- Serialize transactions, reversals and manual cash edits for this portfolio
    perform 1 from public.portfolios as p
    where p.id = p_portfolio_id and p.user_id = v_user_id and p.archived_at is null
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object(
        'instrument_id', p_instrument_id,
        'transaction_type', v_transaction_type,
        'quantity', p_quantity,
        'unit_price', p_unit_price,
        'currency', v_currency,
        'transaction_at', p_transaction_at,
        'notes', v_notes
    );
    select * into v_claim from private.claim_portfolio_request(
        p_portfolio_id, p_client_request_id, 'record_transaction', v_payload
    );

    if v_claim.was_replayed then
        if v_claim.resource_id is null then
            raise exception using errcode = 'P0001', message = 'portfolio_idempotency_incomplete';
        end if;
        select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
        into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
        from private.get_portfolio_position_summary(p_portfolio_id, p_instrument_id) as s;
        return jsonb_build_object(
            'transaction_id', v_claim.resource_id, 'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text
        );
    end if;

    select i.id, i.currency, i.is_active into v_instrument
    from public.instruments as i where i.id = p_instrument_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_not_found';
    end if;
    if v_transaction_type = 'BUY' and v_instrument.is_active = false then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_inactive';
    end if;
    if v_instrument.currency <> v_currency then
        raise exception using errcode = 'P0001', message = 'portfolio_instrument_currency_mismatch';
    end if;

    insert into public.portfolio_transactions (
        portfolio_id, instrument_id, transaction_type, quantity, unit_price,
        transaction_currency, transaction_at, notes, client_request_id
    ) values (
        p_portfolio_id, p_instrument_id, v_transaction_type, p_quantity,
        p_unit_price, v_currency, p_transaction_at, v_notes, p_client_request_id
    ) returning id into v_transaction_id;

    perform private.complete_portfolio_request(
        p_portfolio_id, p_client_request_id, v_transaction_id
    );

    insert into public.portfolio_instruments (portfolio_id, instrument_id, is_visible)
    values (p_portfolio_id, p_instrument_id, true)
    on conflict (portfolio_id, instrument_id) do update set is_visible = true;

    select f.current_quantity, f.remaining_cost_basis, f.realized_pnl
    into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
    from private.get_portfolio_position_summary(p_portfolio_id, p_instrument_id) as f;


    return jsonb_build_object(
        'transaction_id', v_transaction_id, 'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reverse_portfolio_transaction(p_transaction_id uuid, p_client_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_reason text := nullif(btrim(p_reason), '');
    v_tx public.portfolio_transactions%rowtype;
    v_payload jsonb;
    v_claim record;
    v_current_quantity numeric;
    v_remaining_cost_basis numeric;
    v_realized_pnl numeric;
begin
    if v_user_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_authentication_required';
    end if;
    if p_client_request_id is null then
        raise exception using errcode = 'P0001', message = 'portfolio_client_request_id_required';
    end if;
    if v_reason is null or length(v_reason) > 1000 then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_reversal_reason';
    end if;

    select t.* into v_tx
    from public.portfolio_transactions as t
    join public.portfolios as p on p.id = t.portfolio_id
    where t.id = p_transaction_id and p.user_id = v_user_id and p.archived_at is null
    for update of p, t;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_not_found_or_forbidden';
    end if;

    v_payload := jsonb_build_object('transaction_id', p_transaction_id, 'reason', v_reason);
    select * into v_claim from private.claim_portfolio_request(
        v_tx.portfolio_id, p_client_request_id, 'reverse_transaction', v_payload
    );

    if v_claim.was_replayed then
        select s.current_quantity, s.remaining_cost_basis, s.realized_pnl
        into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
        from private.get_portfolio_position_summary(v_tx.portfolio_id, v_tx.instrument_id) as s;
        return jsonb_build_object(
            'transaction_id', p_transaction_id, 'was_replayed', true,
            'current_quantity', v_current_quantity::text,
            'remaining_cost_basis', v_remaining_cost_basis::text,
            'realized_pnl', v_realized_pnl::text
        );
    end if;

    if v_tx.is_reversed then
        raise exception using errcode = 'P0001', message = 'portfolio_transaction_already_reversed';
    end if;

    update public.portfolio_transactions
    set is_reversed = true,
        reversed_at = now(),
        reversal_reason = v_reason,
        reversal_client_request_id = p_client_request_id
    where id = p_transaction_id;

    perform private.complete_portfolio_request(
        v_tx.portfolio_id, p_client_request_id, p_transaction_id
    );

    select f.current_quantity, f.remaining_cost_basis, f.realized_pnl
    into v_current_quantity, v_remaining_cost_basis, v_realized_pnl
    from private.get_portfolio_position_summary(v_tx.portfolio_id, v_tx.instrument_id) as f;

    return jsonb_build_object(
        'transaction_id', p_transaction_id, 'was_replayed', false,
        'current_quantity', v_current_quantity::text,
        'remaining_cost_basis', v_remaining_cost_basis::text,
        'realized_pnl', v_realized_pnl::text
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_portfolio_activity(p_portfolio_id uuid, p_limit integer DEFAULT 20, p_filter text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_before_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_source_kind text DEFAULT NULL::text, p_before_activity_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(activity_id uuid, source_kind text, activity_type text, portfolio_id uuid, instrument_id uuid, symbol text, company_name text, market text, quantity numeric, unit_price numeric, gross_amount numeric, currency text, occurred_at timestamp with time zone, created_at timestamp with time zone, notes text, is_reversed boolean, reversed_at timestamp with time zone, reversal_reason text, has_more boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_filter text;
    v_search text;
    v_cursor_part_count integer;
begin
    if v_user_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_authentication_required';
    end if;

    if p_portfolio_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_portfolio_required';
    end if;

    -- A single generic response deliberately avoids disclosing whether a
    -- foreign, archived, or nonexistent portfolio exists.
    if not exists (
        select 1
        from public.portfolios as p
        where p.id = p_portfolio_id
          and p.user_id = v_user_id
          and p.archived_at is null
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_not_found_or_access_denied';
    end if;

    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_limit_out_of_range';
    end if;

    v_filter := pg_catalog.upper(pg_catalog.btrim(coalesce(p_filter, '')));
    if v_filter not in ('ALL', 'BUY', 'SELL') then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_invalid_filter';
    end if;

    v_search := nullif(pg_catalog.btrim(coalesce(p_search, '')), '');
    if v_search is not null and pg_catalog.char_length(v_search) > 100 then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_search_too_long';
    end if;

    v_cursor_part_count :=
        (p_before_occurred_at is not null)::integer
        + (p_before_created_at is not null)::integer
        + (p_before_source_kind is not null)::integer
        + (p_before_activity_id is not null)::integer;

    if v_cursor_part_count not in (0, 4) then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_incomplete_cursor';
    end if;

    if v_cursor_part_count = 4
       and p_before_source_kind not in ('TRANSACTION') then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_activity_invalid_cursor_source';
    end if;

    return query
    with unified_activity as (
        select
            t.id as activity_id,
            'TRANSACTION'::text as source_kind,
            t.transaction_type as activity_type,
            t.portfolio_id,
            t.instrument_id,
            i.symbol,
            i.company_name,
            i.market,
            t.quantity,
            t.unit_price,
            (t.quantity * t.unit_price)::numeric as gross_amount,
            t.transaction_currency as currency,
            t.transaction_at as occurred_at,
            t.created_at,
            t.notes,
            t.is_reversed,
            t.reversed_at,
            t.reversal_reason
        from public.portfolio_transactions as t
        left join public.instruments as i
          on i.id = t.instrument_id
        where t.portfolio_id = p_portfolio_id
          and (v_filter = 'ALL' or v_filter = t.transaction_type)
          and (
              v_search is null
              or pg_catalog.strpos(
                  pg_catalog.lower(coalesce(i.symbol, '')),
                  pg_catalog.lower(v_search)
              ) > 0
              or pg_catalog.strpos(
                  pg_catalog.lower(coalesce(i.company_name, '')),
                  pg_catalog.lower(v_search)
              ) > 0
          )

    ),
    cursor_filtered as (
        select ua.*
        from unified_activity as ua
        where v_cursor_part_count = 0
           or (
                ua.occurred_at,
                ua.created_at,
                ua.source_kind,
                ua.activity_id
              ) < (
                p_before_occurred_at,
                p_before_created_at,
                p_before_source_kind,
                p_before_activity_id
              )
    ),
    fetched as materialized (
        select cf.*
        from cursor_filtered as cf
        order by
            cf.occurred_at desc,
            cf.created_at desc,
            cf.source_kind desc,
            cf.activity_id desc
        limit (p_limit + 1)
    ),
    numbered as (
        select
            f.*,
            pg_catalog.row_number() over (
                order by
                    f.occurred_at desc,
                    f.created_at desc,
                    f.source_kind desc,
                    f.activity_id desc
            ) as page_row_number,
            (pg_catalog.count(*) over () > p_limit) as page_has_more
        from fetched as f
    )
    select
        n.activity_id,
        n.source_kind,
        n.activity_type,
        n.portfolio_id,
        n.instrument_id,
        n.symbol,
        n.company_name,
        n.market,
        n.quantity,
        n.unit_price,
        n.gross_amount,
        n.currency,
        n.occurred_at,
        n.created_at,
        n.notes,
        n.is_reversed,
        n.reversed_at,
        n.reversal_reason,
        n.page_has_more as has_more
    from numbered as n
    where n.page_row_number <= p_limit
    order by
        n.occurred_at desc,
        n.created_at desc,
        n.source_kind desc,
        n.activity_id desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_my_investments(p_client_request_id uuid, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_user_id uuid := auth.uid();
    v_confirmation constant text := 'RESET_ALL_INVESTMENTS';
    v_existing private.investment_reset_requests%rowtype;
    v_result jsonb;
    v_reset_at timestamp with time zone := now();
    v_portfolio_count bigint := 0;
    v_transaction_count bigint := 0;
    v_instrument_count bigint := 0;
    v_snapshot_count bigint := 0;
    v_snapshot_position_count bigint := 0;
    v_request_key_count bigint := 0;
begin
    if v_user_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_authentication_required';
    end if;

    if p_client_request_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_client_request_id_required';
    end if;

    if btrim(coalesce(p_confirmation, '')) <> v_confirmation then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_reset_confirmation_required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_user_id::text, 0)
    );

    select r.*
    into v_existing
    from private.investment_reset_requests as r
    where r.user_id = v_user_id
      and r.client_request_id = p_client_request_id
    for update;

    if found then
        if v_existing.confirmation is distinct from v_confirmation then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_conflict';
        end if;

        if v_existing.result is null or v_existing.completed_at is null then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_idempotency_incomplete';
        end if;

        return v_existing.result || jsonb_build_object('was_replayed', true);
    end if;

    insert into private.investment_reset_requests (
        user_id, client_request_id, confirmation, result, created_at, completed_at
    ) values (
        v_user_id, p_client_request_id, v_confirmation, null, v_reset_at, null
    );

    perform 1 from public.portfolios as p
    where p.user_id = v_user_id and p.archived_at is null
    for update;

    select count(*) into v_portfolio_count
    from public.portfolios as p
    where p.user_id = v_user_id and p.archived_at is null;

    -- Delete transactions
    with deleted as (
        delete from public.portfolio_transactions as t
        where t.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_transaction_count from deleted;

    -- Delete snapshot positions
    with deleted as (
        delete from public.portfolio_snapshot_positions as sp
        where sp.snapshot_id in (
            select s.id from public.portfolio_snapshots as s
            join public.portfolios as p on p.id = s.portfolio_id
            where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_snapshot_position_count from deleted;

    -- Delete snapshots
    with deleted as (
        delete from public.portfolio_snapshots as s
        where s.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_snapshot_count from deleted;

    -- Delete portfolio instruments
    with deleted as (
        delete from public.portfolio_instruments as pi
        where pi.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_instrument_count from deleted;

    -- Delete portfolio request keys
    with deleted as (
        delete from private.portfolio_request_keys as k
        where k.portfolio_id in (
            select p.id from public.portfolios as p where p.user_id = v_user_id
        )
        returning 1
    )
    select count(*) into v_request_key_count from deleted;

    delete from public.portfolio_cash_accounts a using public.portfolios p
    where p.id=a.portfolio_id and p.user_id=v_user_id;

    v_result := jsonb_build_object(
        'reset_at', v_reset_at,
        'portfolio_count', v_portfolio_count,
        'deleted_transaction_count', v_transaction_count,
        'deleted_instrument_count', v_instrument_count,
        'deleted_snapshot_count', v_snapshot_count,
        'deleted_snapshot_position_count', v_snapshot_position_count,
        'deleted_request_key_count', v_request_key_count,
        'was_replayed', false
    );

    update private.investment_reset_requests
    set result = v_result,
        completed_at = now()
    where user_id = v_user_id
      and client_request_id = p_client_request_id;

    return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.build_portfolio_snapshot(p_portfolio_id uuid, p_snapshot_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
    v_portfolio public.portfolios%rowtype;
    v_cutoff timestamp with time zone;
    v_fx_price numeric;
    v_fx_price_at timestamp with time zone;
    v_fx_is_stale boolean := false;
    v_needs_fx boolean := false;
    v_cash_try numeric;
    v_cash_usd numeric;
    v_cash_base numeric := 0;
    v_holdings_base numeric := 0;
    v_cost_base numeric := 0;
    v_realized_base numeric := 0;
    v_unrealized_base numeric := 0;
    v_total_base numeric;
    v_absolute_pnl_base numeric;
    v_snapshot_id uuid;
    v_status text := 'success';
    v_warnings jsonb := '[]'::jsonb;
    v_position record;
    v_fx_rate numeric;
    v_market_value_base numeric;
    v_cost_basis_base numeric;
begin
    if p_snapshot_date is null
       or p_snapshot_date <> (now() at time zone 'Europe/Istanbul')::date then
        raise exception using errcode = 'P0001', message = 'portfolio_invalid_snapshot_date';
    end if;

    select * into v_portfolio
    from public.portfolios p
    where p.id = p_portfolio_id and p.archived_at is null
    for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'portfolio_snapshot_portfolio_not_found';
    end if;

    v_cutoff := ((p_snapshot_date + 1)::timestamp at time zone 'Europe/Istanbul')
                - interval '1 microsecond';
    select coalesce(sum(current_balance),0) into v_cash_try from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='TRY';
    select coalesce(sum(current_balance),0) into v_cash_usd from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='USD';

    select exists (
        select 1
        from public.portfolio_instruments pi
        join public.instruments i on i.id = pi.instrument_id
        cross join lateral private.get_portfolio_position_summary_at(
            p_portfolio_id, i.id, v_cutoff
        ) s
        where pi.portfolio_id = p_portfolio_id
          and (s.current_quantity > 0 or s.realized_pnl <> 0)
          and i.currency <> v_portfolio.base_currency
    ) or (v_portfolio.base_currency = 'TRY' and v_cash_usd <> 0)
      or (v_portfolio.base_currency = 'USD' and v_cash_try <> 0)
    into v_needs_fx;

    if v_needs_fx then
        select lp.price, lp.price_at, lp.is_stale
        into v_fx_price, v_fx_price_at, v_fx_is_stale
        from public.instrument_latest_prices lp
        join public.instruments i on i.id = lp.instrument_id
        where i.market = 'FX' and i.symbol = 'USDTRY'
          and i.asset_type = 'fx' and i.is_active = true;

        if not found or v_fx_price is null or v_fx_price <= 0 then
            raise exception using errcode = 'P0001', message = 'portfolio_fx_price_missing';
        end if;
        if v_fx_is_stale then
            v_status := 'partial';
            v_warnings := v_warnings || jsonb_build_array('USDTRY price is stale');
        end if;
    else
        v_fx_price := 1;
        v_fx_price_at := null;
    end if;

    v_cash_base := case v_portfolio.base_currency
        when 'TRY' then v_cash_try + v_cash_usd * v_fx_price
        else v_cash_usd + v_cash_try / v_fx_price
    end;

    -- Build the header first, then replace its position rows atomically.
    insert into public.portfolio_snapshots (
        portfolio_id, snapshot_date, base_currency,
        cash_value_base, holdings_value_base, total_value_base,
        total_cost_base, realized_pnl_base, unrealized_pnl_base,
        absolute_pnl_base, valuation_status, warnings,
        calculation_version
    ) values (
        p_portfolio_id, p_snapshot_date, v_portfolio.base_currency,
        0, 0, 0, 0, 0, 0, 0,
        v_status, v_warnings, 2
    )
    on conflict (portfolio_id, snapshot_date) do update
    set base_currency = excluded.base_currency,
        calculation_version = excluded.calculation_version
    returning id into v_snapshot_id;

    delete from public.portfolio_snapshot_positions where snapshot_id = v_snapshot_id;

    for v_position in
        select
            i.id as instrument_id,
            i.currency,
            s.current_quantity as quantity,
            s.remaining_cost_basis,
            s.realized_pnl,
            lp.price,
            lp.price_at,
            lp.provider_code,
            lp.is_stale,
            lp.stale_reason
        from public.portfolio_instruments pi
        join public.instruments i on i.id = pi.instrument_id
        cross join lateral private.get_portfolio_position_summary_at(
            p_portfolio_id, i.id, v_cutoff
        ) s
        left join public.instrument_latest_prices lp on lp.instrument_id = i.id
        where pi.portfolio_id = p_portfolio_id
          and s.current_quantity > 0
        order by i.id
    loop
        if v_position.price is null then
            raise exception using
                errcode = 'P0001',
                message = 'portfolio_instrument_price_missing';
        end if;

        v_fx_rate := case
            when v_position.currency = v_portfolio.base_currency then 1
            when v_portfolio.base_currency = 'TRY' then v_fx_price
            else 1 / v_fx_price
        end;
        v_market_value_base := v_position.quantity * v_position.price * v_fx_rate;
        -- Product convention: the remaining instrument-currency average cost is
        -- translated at snapshot FX. This does not claim transaction-date FX.
        v_cost_basis_base := v_position.remaining_cost_basis * v_fx_rate;

        v_holdings_base := v_holdings_base + v_market_value_base;
        v_cost_base := v_cost_base + v_cost_basis_base;
        v_realized_base := v_realized_base + v_position.realized_pnl * v_fx_rate;
        v_unrealized_base := v_unrealized_base
                             + v_market_value_base - v_cost_basis_base;

        if v_position.is_stale then
            v_status := 'partial';
            v_warnings := v_warnings || jsonb_build_array(
                format('Stale instrument price: %s', v_position.instrument_id)
            );
        end if;

        insert into public.portfolio_snapshot_positions (
            snapshot_id, instrument_id, quantity, price, price_currency,
            price_at, provider_code, fx_rate, fx_rate_at,
            market_value_base, cost_basis_base, unrealized_pnl_base,
            price_is_stale, price_stale_reason
        ) values (
            v_snapshot_id, v_position.instrument_id, v_position.quantity,
            v_position.price, v_position.currency, v_position.price_at,
            v_position.provider_code, v_fx_rate,
            case when v_fx_rate = 1 then null else v_fx_price_at end,
            v_market_value_base, v_cost_basis_base,
            v_market_value_base - v_cost_basis_base,
            v_position.is_stale, v_position.stale_reason
        );
    end loop;

    -- Include realized P/L from fully closed positions too.
    select coalesce(sum(s.realized_pnl * case
      when i.currency=v_portfolio.base_currency then 1
      when v_portfolio.base_currency='TRY' then v_fx_price else 1/v_fx_price end),0)
    into v_realized_base from public.portfolio_instruments pi
    join public.instruments i on i.id=pi.instrument_id
    cross join lateral private.get_portfolio_position_summary_at(p_portfolio_id,i.id,v_cutoff) s
    where pi.portfolio_id=p_portfolio_id;
    v_total_base := v_cash_base + v_holdings_base;
    v_absolute_pnl_base := v_realized_base + v_unrealized_base;

    update public.portfolio_snapshots
    set cash_value_base = v_cash_base,
        holdings_value_base = v_holdings_base,
        total_value_base = v_total_base,
        total_cost_base = v_cost_base,
        realized_pnl_base = v_realized_base,
        unrealized_pnl_base = v_unrealized_base,
        absolute_pnl_base = v_absolute_pnl_base,
        valuation_status = v_status,
        warnings = v_warnings,
        calculation_version = 2
    where id = v_snapshot_id;

    return jsonb_build_object(
        'snapshot_id', v_snapshot_id,
        'portfolio_id', p_portfolio_id,
        'snapshot_date', p_snapshot_date,
        'valuation_status', v_status,
        'position_count', (
            select count(*) from public.portfolio_snapshot_positions
            where snapshot_id = v_snapshot_id
        ),
        'total_value_base', v_total_base::text,
        'warnings', v_warnings
    );
end;
$function$
;

drop function public.initialize_portfolio_cash_accounts(uuid,numeric,numeric,uuid);

drop function public.get_portfolio_cash_state(uuid);

drop function public.get_portfolio_cash_balances(uuid);

drop function public.record_cash_flow(uuid,text,numeric,text,timestamptz,uuid,text);

drop function public.reverse_cash_flow(uuid,uuid,text);

drop function private.initialize_new_portfolio_cash_accounts();

drop function private.get_portfolio_cash_balance(uuid,text);

drop function private.get_portfolio_cash_balance_at(uuid,text,timestamptz);

drop function private.rebuild_portfolio_fifo(uuid,uuid);

drop function private.build_portfolio_snapshot_before_cash_accounts(uuid,date);

drop table public.portfolio_fifo_matches;
drop table public.portfolio_cash_flows;
alter table public.portfolio_cash_accounts rename column opening_balance to current_balance;
alter table public.portfolio_cash_accounts drop column initialized_at;
alter table public.portfolio_cash_accounts rename constraint portfolio_cash_accounts_opening_balance_check to portfolio_cash_accounts_current_balance_check;
-- Preserve historical prices and values, explicitly identifying their old methodology.
update public.portfolio_snapshots set valuation_status='partial',
 warnings=warnings || jsonb_build_array('Historical snapshot uses the pre-simplification calculation method')
 where calculation_version < 2;
alter table public.portfolio_snapshots drop column external_cash_flow_base,
 drop column net_contributions_base, drop column daily_return, drop column cumulative_twr;
comment on column public.portfolio_snapshots.absolute_pnl_base is 'Realized plus unrealized P/L for calculation_version >= 2; legacy snapshots retain their original values.';
comment on column public.portfolio_cash_accounts.current_balance is 'Optional manually entered cash; trades do not change this amount.';
-- Remove obsolete request payloads, retaining trade retry protection.
delete from private.portfolio_request_keys where action in ('initialize_cash_accounts','record_cash_flow','reverse_cash_flow');


create or replace function public.get_portfolio_cash(p_portfolio_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null then raise exception 'portfolio_authentication_required'; end if;
 if not exists(select 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() and archived_at is null) then
  raise exception 'portfolio_not_found_or_forbidden'; end if;
 return jsonb_build_object('try_balance',coalesce((select current_balance from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='TRY'),0),
 'usd_balance',coalesce((select current_balance from public.portfolio_cash_accounts where portfolio_id=p_portfolio_id and currency='USD'),0));
end $$;
create or replace function public.set_portfolio_cash(p_portfolio_id uuid, p_try_balance numeric, p_usd_balance numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null then raise exception 'portfolio_authentication_required'; end if;
 perform 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() and archived_at is null for update;
 if not found then raise exception 'portfolio_not_found_or_forbidden'; end if;
 if p_try_balance is null or p_usd_balance is null or p_try_balance<0 or p_usd_balance<0
 or p_try_balance in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
 or p_usd_balance in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'portfolio_invalid_cash_amount'; end if;
 insert into public.portfolio_cash_accounts(portfolio_id,currency,current_balance)
 values(p_portfolio_id,'TRY',p_try_balance),(p_portfolio_id,'USD',p_usd_balance)
 on conflict(portfolio_id,currency) do update set current_balance=excluded.current_balance,updated_at=now();
 return public.get_portfolio_cash(p_portfolio_id);
end $$;
-- A separate summary includes sold-out instruments, without adding them to the holdings list.
create or replace function public.get_portfolio_realized_pnl(p_portfolio_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare v_try numeric; v_usd numeric;
begin
 if auth.uid() is null then raise exception 'portfolio_authentication_required'; end if;
 if not exists(select 1 from public.portfolios where id=p_portfolio_id and user_id=auth.uid() and archived_at is null) then raise exception 'portfolio_not_found_or_forbidden'; end if;
 select coalesce(sum(s.realized_pnl) filter(where i.currency='TRY'),0),coalesce(sum(s.realized_pnl) filter(where i.currency='USD'),0)
 into v_try,v_usd from public.portfolio_instruments pi join public.instruments i on i.id=pi.instrument_id
 cross join lateral private.get_portfolio_position_summary(pi.portfolio_id,pi.instrument_id) s where pi.portfolio_id=p_portfolio_id;
 return jsonb_build_object('try_pnl',v_try,'usd_pnl',v_usd);
end $$;
revoke all on function public.get_portfolio_cash(uuid), public.set_portfolio_cash(uuid,numeric,numeric),public.get_portfolio_realized_pnl(uuid) from public,anon,authenticated;
grant execute on function public.get_portfolio_cash(uuid), public.set_portfolio_cash(uuid,numeric,numeric),public.get_portfolio_realized_pnl(uuid) to authenticated;
revoke all on function private.get_portfolio_position_summary_at(uuid,uuid,timestamptz),private.get_portfolio_position_summary(uuid,uuid),private.build_portfolio_snapshot(uuid,date) from public,anon,authenticated;
-- Validate every existing transaction sequence before committing the migration.
do $$ declare r record; begin
 for r in select distinct portfolio_id,instrument_id from public.portfolio_transactions loop
  perform * from private.get_portfolio_position_summary(r.portfolio_id,r.instrument_id);
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
