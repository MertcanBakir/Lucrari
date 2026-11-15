begin;

-- Keep the portfolio read model aligned with the financial UI. Daily change
-- values already live in instrument_latest_prices, so returning them from the
-- position RPC avoids a second client-side price query and prevents the RPC
-- return type from diverging from the application model.
drop function public.get_portfolio_positions(uuid);

create function public.get_portfolio_positions(p_portfolio_id uuid)
returns table (
    instrument_id uuid,
    market text,
    symbol text,
    company_name text,
    currency text,
    is_visible boolean,
    quantity numeric,
    remaining_cost_basis numeric,
    average_cost numeric,
    realized_pnl numeric,
    latest_price numeric,
    change_percent numeric,
    change_amount numeric,
    price_at timestamp with time zone,
    provider_code text,
    price_is_stale boolean,
    price_stale_reason text,
    market_value numeric,
    unrealized_pnl numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
    if auth.uid() is null then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_authentication_required';
    end if;

    if not exists (
        select 1
        from public.portfolios p
        where p.id = p_portfolio_id
          and p.user_id = auth.uid()
          and p.archived_at is null
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'portfolio_not_found_or_forbidden';
    end if;

    return query
    select
        i.id,
        i.market,
        i.symbol,
        i.company_name,
        i.currency,
        pi.is_visible,
        s.current_quantity,
        s.remaining_cost_basis,
        case
            when s.current_quantity > 0
                then s.remaining_cost_basis / s.current_quantity
        end,
        s.realized_pnl,
        lp.price,
        lp.change_percent,
        lp.change_amount,
        lp.price_at,
        lp.provider_code,
        lp.is_stale,
        lp.stale_reason,
        case
            when lp.price is not null
                then s.current_quantity * lp.price
        end,
        case
            when lp.price is not null
                then s.current_quantity * lp.price - s.remaining_cost_basis
        end
    from public.portfolio_instruments pi
    join public.instruments i on i.id = pi.instrument_id
    cross join lateral private.get_portfolio_position_summary(
        p_portfolio_id,
        i.id
    ) s
    left join public.instrument_latest_prices lp on lp.instrument_id = i.id
    where pi.portfolio_id = p_portfolio_id
      and s.current_quantity > 0
    order by pi.display_order, i.symbol;
end;
$$;

revoke all on function public.get_portfolio_positions(uuid)
    from public, anon;
grant execute on function public.get_portfolio_positions(uuid)
    to authenticated;

commit;
