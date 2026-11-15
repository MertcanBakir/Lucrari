begin;

-- Every mobile mutation carries a caller-generated UUID. Existing rows are
-- backfilled defensively before the columns become NOT NULL so this migration
-- remains safe if data appears between review and deployment.
alter table public.portfolio_transactions
    add column client_request_id uuid,
    add column is_reversed boolean not null default false,
    add column reversed_at timestamp with time zone,
    add column reversal_reason text,
    add column reversal_client_request_id uuid;

update public.portfolio_transactions
set client_request_id = gen_random_uuid()
where client_request_id is null;

alter table public.portfolio_transactions
    alter column client_request_id set not null,
    add constraint portfolio_transactions_client_request_unique
        unique (portfolio_id, client_request_id),
    add constraint portfolio_transactions_reversal_state_check
        check (
            (
                is_reversed = false
                and reversed_at is null
                and reversal_reason is null
                and reversal_client_request_id is null
            )
            or
            (
                is_reversed = true
                and reversed_at is not null
                and reversal_reason is not null
                and length(btrim(reversal_reason)) > 0
                and reversal_client_request_id is not null
                and reversal_client_request_id <> client_request_id
            )
        ),
    add constraint portfolio_transactions_quantity_finite_check
        check (
            quantity <> 'NaN'::numeric
            and quantity <> 'Infinity'::numeric
            and quantity <> '-Infinity'::numeric
        ),
    add constraint portfolio_transactions_unit_price_finite_check
        check (
            unit_price <> 'NaN'::numeric
            and unit_price <> 'Infinity'::numeric
            and unit_price <> '-Infinity'::numeric
        );

create unique index portfolio_transactions_reversal_request_unique
    on public.portfolio_transactions (portfolio_id, reversal_client_request_id)
    where reversal_client_request_id is not null;

alter table public.portfolio_cash_flows
    add column client_request_id uuid,
    add column is_reversed boolean not null default false,
    add column reversed_at timestamp with time zone,
    add column reversal_reason text,
    add column reversal_client_request_id uuid;

update public.portfolio_cash_flows
set client_request_id = gen_random_uuid()
where client_request_id is null;

alter table public.portfolio_cash_flows
    alter column client_request_id set not null,
    add constraint portfolio_cash_flows_client_request_unique
        unique (portfolio_id, client_request_id),
    add constraint portfolio_cash_flows_reversal_state_check
        check (
            (
                is_reversed = false
                and reversed_at is null
                and reversal_reason is null
                and reversal_client_request_id is null
            )
            or
            (
                is_reversed = true
                and reversed_at is not null
                and reversal_reason is not null
                and length(btrim(reversal_reason)) > 0
                and reversal_client_request_id is not null
                and reversal_client_request_id <> client_request_id
            )
        ),
    add constraint portfolio_cash_flows_amount_finite_check
        check (
            amount <> 'NaN'::numeric
            and amount <> 'Infinity'::numeric
            and amount <> '-Infinity'::numeric
        );

create unique index portfolio_cash_flows_reversal_request_unique
    on public.portfolio_cash_flows (portfolio_id, reversal_client_request_id)
    where reversal_client_request_id is not null;

comment on column public.portfolio_transactions.client_request_id is
    'Caller-generated UUID used to make transaction creation idempotent within a portfolio.';
comment on column public.portfolio_cash_flows.client_request_id is
    'Caller-generated UUID used to make cash-flow creation idempotent within a portfolio.';

commit;
