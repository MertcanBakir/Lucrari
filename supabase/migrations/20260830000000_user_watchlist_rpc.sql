-- Restored from the applied Supabase migration history.

begin;

create table public.user_watchlist_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    instrument_id uuid not null references public.instruments(id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    constraint user_watchlist_items_user_instrument_key
        unique (user_id, instrument_id)
);

create index user_watchlist_items_user_created_idx
    on public.user_watchlist_items (user_id, created_at desc, id desc);

alter table public.user_watchlist_items enable row level security;

create policy "Users can read own watchlist items"
    on public.user_watchlist_items
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create policy "Users can create own watchlist items"
    on public.user_watchlist_items
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Users can delete own watchlist items"
    on public.user_watchlist_items
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);

-- Direct mobile access stays closed. The policies above remain as a second
-- ownership boundary if table privileges are deliberately introduced later.
revoke all privileges on table public.user_watchlist_items
    from public, anon, authenticated;

create function public.get_my_watchlist(
    p_limit integer default 20,
    p_offset integer default 0
)
returns table (
    watchlist_id uuid,
    instrument_id uuid,
    symbol text,
    company_name text,
    market text,
    asset_type text,
    currency text,
    is_active boolean,
    has_price boolean,
    price numeric,
    change_amount numeric,
    change_percent numeric,
    price_at timestamp with time zone,
    price_is_stale boolean,
    stale_reason text,
    added_at timestamp with time zone,
    total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_authentication_required';
    end if;

    if p_limit is null or p_limit < 1 or p_limit > 100 then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_limit_out_of_range';
    end if;

    if p_offset is null or p_offset < 0 then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_offset_out_of_range';
    end if;

    return query
    select
        w.id as watchlist_id,
        i.id as instrument_id,
        i.symbol,
        i.company_name,
        i.market,
        i.asset_type,
        i.currency,
        i.is_active,
        (lp.instrument_id is not null) as has_price,
        lp.price,
        lp.change_amount,
        lp.change_percent,
        lp.price_at,
        case
            when lp.instrument_id is null then null::boolean
            else lp.is_stale
        end as price_is_stale,
        lp.stale_reason,
        w.created_at as added_at,
        count(*) over () as total_count
    from public.user_watchlist_items as w
    join public.instruments as i
      on i.id = w.instrument_id
    left join public.instrument_latest_prices as lp
      on lp.instrument_id = i.id
    where w.user_id = v_user_id
    order by w.created_at desc, w.id desc
    limit p_limit
    offset p_offset;
end;
$$;

comment on function public.get_my_watchlist(integer, integer) is
    'Returns the authenticated user watchlist with nullable latest-price fields and deterministic SQL pagination.';

create function public.set_my_watchlist_item(
    p_instrument_id uuid,
    p_is_watched boolean
)
returns table (
    instrument_id uuid,
    is_watched boolean,
    was_changed boolean,
    watchlist_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_watchlist_id uuid;
    v_is_active boolean;
    v_was_changed boolean := false;
begin
    if v_user_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_authentication_required';
    end if;

    if p_instrument_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_instrument_id_required';
    end if;

    if p_is_watched is null then
        raise exception using
            errcode = 'P0001',
            message = 'watchlist_state_required';
    end if;

    if p_is_watched then
        -- An existing row remains an idempotent success even if the instrument
        -- was deactivated after the user originally added it.
        select w.id
        into v_watchlist_id
        from public.user_watchlist_items as w
        where w.user_id = v_user_id
          and w.instrument_id = p_instrument_id;

        if found then
            return query
            select p_instrument_id, true, false, v_watchlist_id;
            return;
        end if;

        -- A share lock makes the active check and insertion one consistent
        -- decision if a catalog writer tries to deactivate the instrument.
        select i.is_active
        into v_is_active
        from public.instruments as i
        where i.id = p_instrument_id
        for share;

        if not found then
            raise exception using
                errcode = 'P0001',
                message = 'watchlist_instrument_not_found';
        end if;

        if not v_is_active then
            raise exception using
                errcode = 'P0001',
                message = 'watchlist_instrument_inactive';
        end if;

        insert into public.user_watchlist_items (
            user_id,
            instrument_id
        ) values (
            v_user_id,
            p_instrument_id
        )
        on conflict on constraint user_watchlist_items_user_instrument_key
        do nothing
        returning id into v_watchlist_id;

        v_was_changed := found;

        if v_watchlist_id is null then
            -- A concurrent idempotent insertion may have won the unique-key
            -- race. Read that committed row and return the same stable result.
            select w.id
            into v_watchlist_id
            from public.user_watchlist_items as w
            where w.user_id = v_user_id
              and w.instrument_id = p_instrument_id;
        end if;

        return query
        select p_instrument_id, true, v_was_changed, v_watchlist_id;
        return;
    end if;

    delete from public.user_watchlist_items as w
    where w.user_id = v_user_id
      and w.instrument_id = p_instrument_id
    returning w.id into v_watchlist_id;

    v_was_changed := found;

    return query
    select p_instrument_id, false, v_was_changed, null::uuid;
end;
$$;

comment on function public.set_my_watchlist_item(uuid, boolean) is
    'Idempotently adds or removes one instrument from the authenticated user watchlist without affecting portfolio state.';

alter function public.get_my_watchlist(integer, integer) owner to postgres;

alter function public.set_my_watchlist_item(uuid, boolean) owner to postgres;

revoke all on function public.get_my_watchlist(integer, integer)
    from public, anon, authenticated;

revoke all on function public.set_my_watchlist_item(uuid, boolean)
    from public, anon, authenticated;

grant execute on function public.get_my_watchlist(integer, integer)
    to authenticated;

grant execute on function public.set_my_watchlist_item(uuid, boolean)
    to authenticated;

commit;
