begin;

insert into auth.users (id)
values ('10000000-0000-0000-0000-000000000001');

select set_config(
    'request.jwt.claim.sub',
    '10000000-0000-0000-0000-000000000001',
    true
);

insert into public.instruments (
    id, market, symbol, company_name, asset_type, currency, is_active
)
values (
    '20000000-0000-0000-0000-000000000001',
    'BIST100', 'TEST', 'Test Instrument', 'stock', 'TRY', true
);

insert into public.instrument_latest_prices (
    instrument_id, price, currency, previous_close, change_amount,
    change_percent, price_at, provider_code, is_stale
)
values (
    '20000000-0000-0000-0000-000000000001',
    100, 'TRY', 95, 5, 5.263157894737,
    now(), 'test', false
);

insert into public.portfolios (
    id, user_id, name, base_currency, is_default
)
values (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'New portfolio', 'TRY', true
);

do $$
declare
    v_result jsonb;
    v_balance numeric;
    v_quantity numeric;
    v_change_amount numeric;
    v_change_percent numeric;
begin
    v_result := public.record_cash_flow(
        '30000000-0000-0000-0000-000000000001',
        'DEPOSIT', 100, 'TRY', now(),
        '40000000-0000-0000-0000-000000000001', null
    );
    if (v_result ->> 'cash_balance')::numeric <> 100 then
        raise exception 'deposit balance assertion failed: %', v_result;
    end if;

    v_result := public.record_portfolio_transaction(
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'BUY', 1, 100, 'TRY', now(),
        '40000000-0000-0000-0000-000000000002', null
    );
    if (v_result ->> 'available_cash')::numeric <> 0 then
        raise exception 'buy balance assertion failed: %', v_result;
    end if;

    -- The balance is now zero, but replaying the committed BUY must succeed.
    v_result := public.record_portfolio_transaction(
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'BUY', 1, 100, 'TRY', now(),
        '40000000-0000-0000-0000-000000000002', null
    );
    if (v_result ->> 'was_replayed')::boolean is not true then
        raise exception 'BUY replay assertion failed: %', v_result;
    end if;

    begin
        perform public.record_portfolio_transaction(
            '30000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            'BUY', 1, 1, 'TRY', now(),
            '40000000-0000-0000-0000-000000000003', null
        );
        raise exception 'expected insufficient-cash rejection';
    exception when others then
        if sqlerrm <> 'portfolio_insufficient_cash' then
            raise;
        end if;
    end;

    perform public.record_cash_flow(
        '30000000-0000-0000-0000-000000000001',
        'DEPOSIT', 50, 'TRY', now(),
        '40000000-0000-0000-0000-000000000004', null
    );
    v_result := public.record_cash_flow(
        '30000000-0000-0000-0000-000000000001',
        'WITHDRAWAL', 50, 'TRY', now(),
        '40000000-0000-0000-0000-000000000005', null
    );
    v_result := public.record_cash_flow(
        '30000000-0000-0000-0000-000000000001',
        'WITHDRAWAL', 50, 'TRY', now(),
        '40000000-0000-0000-0000-000000000005', null
    );
    if (v_result ->> 'was_replayed')::boolean is not true then
        raise exception 'withdrawal replay assertion failed: %', v_result;
    end if;

    v_balance := private.get_portfolio_cash_balance(
        '30000000-0000-0000-0000-000000000001', 'TRY'
    );
    if v_balance <> 0 then
        raise exception 'final cash assertion failed: %', v_balance;
    end if;

    select current_quantity into v_quantity
    from private.get_portfolio_position_summary(
        '30000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001'
    );
    if v_quantity <> 1 then
        raise exception 'FIFO quantity assertion failed: %', v_quantity;
    end if;

    select p.change_amount, p.change_percent
    into v_change_amount, v_change_percent
    from public.get_portfolio_positions(
        '30000000-0000-0000-0000-000000000001'
    ) p;

    if v_change_amount <> 5
       or round(v_change_percent, 6) <> round(5.263157894737::numeric, 6) then
        raise exception 'position daily-change assertion failed: amount %, percent %',
            v_change_amount, v_change_percent;
    end if;
end;
$$;

-- Simulate a legacy portfolio whose trades predate cash-account initialization.
insert into public.portfolios (
    id, user_id, name, base_currency, is_default, created_at
)
values (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Legacy portfolio', 'TRY', false, now() - interval '3 days'
);

delete from public.portfolio_cash_accounts
where portfolio_id = '30000000-0000-0000-0000-000000000002';

insert into public.portfolio_transactions (
    id, portfolio_id, instrument_id, transaction_type, quantity, unit_price,
    transaction_currency, transaction_at, client_request_id, created_at
)
values (
    '50000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'BUY', 10, 100, 'TRY', now() - interval '2 days',
    '50000000-0000-0000-0000-000000000002', now() - interval '2 days'
);

insert into public.portfolio_instruments (portfolio_id, instrument_id, is_visible)
values (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001', true
);

do $$
declare
    v_result jsonb;
    v_snapshot public.portfolio_snapshots%rowtype;
begin
    v_result := private.build_portfolio_snapshot(
        '30000000-0000-0000-0000-000000000002',
        (now() at time zone 'Europe/Istanbul')::date - 1
    );
    select * into v_snapshot
    from public.portfolio_snapshots
    where id = (v_result ->> 'snapshot_id')::uuid;

    if v_snapshot.cash_value_base <> 0
       or v_snapshot.total_value_base <> 1000
       or v_snapshot.valuation_status <> 'partial'
       or not (v_snapshot.warnings ? 'Cash accounts were not initialized at snapshot cutoff') then
        raise exception 'pre-initialization snapshot assertion failed: %', row_to_json(v_snapshot);
    end if;

    perform public.initialize_portfolio_cash_accounts(
        '30000000-0000-0000-0000-000000000002',
        500, 0,
        '60000000-0000-0000-0000-000000000001'
    );

    v_result := private.build_portfolio_snapshot(
        '30000000-0000-0000-0000-000000000002',
        (now() at time zone 'Europe/Istanbul')::date
    );
    select * into v_snapshot
    from public.portfolio_snapshots
    where id = (v_result ->> 'snapshot_id')::uuid;

    if v_snapshot.cash_value_base <> 500
       or v_snapshot.holdings_value_base <> 1000
       or v_snapshot.total_value_base <> 1500
       or v_snapshot.net_contributions_base <> 500
       or not (v_snapshot.warnings ? 'Pre-initialization activity is excluded from the cash performance baseline') then
        raise exception 'initialized legacy snapshot assertion failed: %', row_to_json(v_snapshot);
    end if;
end;
$$;

do $$
begin
    if has_function_privilege(
        'anon',
        'public.get_portfolio_cash_state(uuid)',
        'EXECUTE'
    ) then
        raise exception 'anon unexpectedly has cash-state RPC access';
    end if;
end;
$$;

rollback;
