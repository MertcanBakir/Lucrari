begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Reset requests live outside a portfolio because the reset itself clears every
-- portfolio-scoped idempotency key. Keeping a user-level receipt makes retries
-- safe even after the investment ledgers have been emptied.
create table if not exists private.investment_reset_requests (
    user_id uuid not null references auth.users(id) on delete cascade,
    client_request_id uuid not null,
    confirmation text not null,
    result jsonb,
    created_at timestamp with time zone not null default now(),
    completed_at timestamp with time zone,
    primary key (user_id, client_request_id),
    constraint investment_reset_requests_confirmation_check
        check (confirmation = 'RESET_ALL_INVESTMENTS'),
    constraint investment_reset_requests_completion_check
        check (
            (result is null and completed_at is null)
            or
            (result is not null and completed_at is not null)
        )
);

revoke all on table private.investment_reset_requests
    from public, anon, authenticated;

create or replace function public.reset_my_investments(
    p_client_request_id uuid,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
    v_user_id uuid := auth.uid();
    v_confirmation constant text := 'RESET_ALL_INVESTMENTS';
    v_existing private.investment_reset_requests%rowtype;
    v_result jsonb;
    v_reset_at timestamp with time zone := now();
    v_portfolio_count bigint := 0;
    v_transaction_count bigint := 0;
    v_cash_flow_count bigint := 0;
    v_fifo_match_count bigint := 0;
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

    -- Serialize reset retries for one authenticated user. Existing portfolio
    -- rows are also locked below so BUY/SELL/cash/snapshot RPCs cannot commit
    -- halfway through this reset.
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
        user_id,
        client_request_id,
        confirmation
    ) values (
        v_user_id,
        p_client_request_id,
        v_confirmation
    );

    -- Transaction, cash and snapshot writers lock the same portfolio rows.
    -- Ordering keeps multi-portfolio resets deterministic.
    perform p.id
    from public.portfolios as p
    where p.user_id = v_user_id
    order by p.id
    for update;

    select count(*)
    into v_portfolio_count
    from public.portfolios as p
    where p.user_id = v_user_id;

    delete from public.portfolio_snapshot_positions as sp
    using public.portfolio_snapshots as s, public.portfolios as p
    where sp.snapshot_id = s.id
      and s.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_snapshot_position_count = row_count;

    delete from public.portfolio_snapshots as s
    using public.portfolios as p
    where s.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_snapshot_count = row_count;

    delete from public.portfolio_fifo_matches as f
    using public.portfolios as p
    where f.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_fifo_match_count = row_count;

    delete from public.portfolio_transactions as t
    using public.portfolios as p
    where t.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_transaction_count = row_count;

    delete from public.portfolio_cash_flows as c
    using public.portfolios as p
    where c.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_cash_flow_count = row_count;

    delete from public.portfolio_instruments as pi
    using public.portfolios as p
    where pi.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_instrument_count = row_count;

    delete from private.portfolio_request_keys as k
    using public.portfolios as p
    where k.portfolio_id = p.id
      and p.user_id = v_user_id;
    get diagnostics v_request_key_count = row_count;

    v_result := jsonb_build_object(
        'was_replayed', false,
        'reset_at', v_reset_at,
        'portfolio_count', v_portfolio_count,
        'deleted_transaction_count', v_transaction_count,
        'deleted_cash_flow_count', v_cash_flow_count,
        'deleted_fifo_match_count', v_fifo_match_count,
        'deleted_instrument_count', v_instrument_count,
        'deleted_snapshot_count', v_snapshot_count,
        'deleted_snapshot_position_count', v_snapshot_position_count,
        'deleted_request_key_count', v_request_key_count
    );

    update private.investment_reset_requests
    set result = v_result,
        completed_at = v_reset_at
    where user_id = v_user_id
      and client_request_id = p_client_request_id;

    return v_result;
end;
$$;

comment on function public.reset_my_investments(uuid, text) is
    'Atomically clears the authenticated user investment ledgers, derived FIFO state, instrument links and snapshots while preserving portfolios and the auth user.';

revoke all on function public.reset_my_investments(uuid, text)
    from public, anon;
grant execute on function public.reset_my_investments(uuid, text)
    to authenticated;

commit;
