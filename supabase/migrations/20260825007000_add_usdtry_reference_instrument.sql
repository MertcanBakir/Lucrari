begin;

insert into public.instruments (
    market, symbol, company_name, is_active, asset_type, currency
) values (
    'FX', 'USDTRY', 'ABD Doları / Türk Lirası', true, 'fx', 'TRY'
)
on conflict (market, symbol) do update
set company_name = excluded.company_name,
    is_active = excluded.is_active,
    asset_type = excluded.asset_type,
    currency = excluded.currency;

commit;
