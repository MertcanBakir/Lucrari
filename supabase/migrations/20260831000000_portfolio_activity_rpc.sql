-- Restored from the applied Supabase migration history.

begin;

-- The existing portfolio/date indexes do not contain the final UUID
-- tie-breaker used by the mobile cursor. These exact-order indexes make the
-- four-part keyset predicate deterministic without scanning a portfolio's
-- complete history.
create index if not exists portfolio_transactions_activity_cursor_idx
    on public.portfolio_transactions (
        portfolio_id,
        transaction_at desc,
        created_at desc,
        id desc
    );

create index if not exists portfolio_cash_flows_activity_cursor_idx
    on public.portfolio_cash_flows (
        portfolio_id,
        flow_at desc,
        created_at desc,
        id desc
    );

-- Remove only the exact public contract before recreating it. This makes a
-- repeated local application deterministic and cannot remove another
-- overload accidentally.
drop function if exists public.get_my_portfolio_activity(
    uuid,
    integer,
    text,
    text,
    timestamp with time zone,
    timestamp with time zone,
    text,
    uuid
);

create function public.get_my_portfolio_activity(
    p_portfolio_id uuid,
    p_limit integer default 20,
    p_filter text default 'ALL',
    p_search text default null,
    p_before_occurred_at timestamp with time zone default null,
    p_before_created_at timestamp with time zone default null,
    p_before_source_kind text default null,
    p_before_activity_id uuid default null
)
returns table (
    activity_id uuid,
    source_kind text,
    activity_type text,
    portfolio_id uuid,
    instrument_id uuid,
    symbol text,
    company_name text,
    market text,
    quantity numeric,
    unit_price numeric,
    gross_amount numeric,
    currency text,
    occurred_at timestamp with time zone,
    created_at timestamp with time zone,
    notes text,
    is_reversed boolean,
    reversed_at timestamp with time zone,
    reversal_reason text,
    has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    if v_filter not in ('ALL', 'BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL') then
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
       and p_before_source_kind not in ('TRANSACTION', 'CASH_FLOW') then
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

        union all

        select
            c.id as activity_id,
            'CASH_FLOW'::text as source_kind,
            c.flow_type as activity_type,
            c.portfolio_id,
            null::uuid as instrument_id,
            null::text as symbol,
            null::text as company_name,
            null::text as market,
            null::numeric as quantity,
            null::numeric as unit_price,
            c.amount::numeric as gross_amount,
            c.currency,
            c.flow_at as occurred_at,
            c.created_at,
            c.notes,
            c.is_reversed,
            c.reversed_at,
            c.reversal_reason
        from public.portfolio_cash_flows as c
        where c.portfolio_id = p_portfolio_id
          and (v_filter = 'ALL' or v_filter = c.flow_type)
          and v_search is null
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
$$;

alter function public.get_my_portfolio_activity(
    uuid,
    integer,
    text,
    text,
    timestamp with time zone,
    timestamp with time zone,
    text,
    uuid
) owner to postgres;

comment on function public.get_my_portfolio_activity(
    uuid,
    integer,
    text,
    text,
    timestamp with time zone,
    timestamp with time zone,
    text,
    uuid
) is
    'Returns the authenticated owner''s existing post-reset BUY, SELL, DEPOSIT, and WITHDRAWAL rows as one deterministic keyset-paginated activity stream. It performs no current-price or FX conversion.';

revoke all on function public.get_my_portfolio_activity(
    uuid,
    integer,
    text,
    text,
    timestamp with time zone,
    timestamp with time zone,
    text,
    uuid
) from public, anon, authenticated;

grant execute on function public.get_my_portfolio_activity(
    uuid,
    integer,
    text,
    text,
    timestamp with time zone,
    timestamp with time zone,
    text,
    uuid
) to authenticated;

commit;
