-- Confirmed 2026 Suratgarh fees. Apply after 001–005 while registration is closed.
-- Existing registration fee_paise values are immutable payment snapshots and are not touched.
begin;

do $$
declare
  v_registration_open boolean;
  v_race text;
  v_count integer := 0;
  v_has_5 boolean := false;
  v_has_10 boolean := false;
  v_has_21 boolean := false;
begin
  select e.registration_open into v_registration_open
  from public.event_config e
  where e.id = 'suratgarh-2026'
  for update;

  if not found then
    raise exception 'Suratgarh event configuration is required before confirming race fees';
  end if;

  if v_registration_open then
    raise exception 'Cannot update confirmed race fees while registration is open';
  end if;

  for v_race in
    select r.race
    from public.race_config r
    where r.event_id = 'suratgarh-2026'
    for update
  loop
    v_count := v_count + 1;
    case v_race
      when '5' then v_has_5 := true;
      when '10' then v_has_10 := true;
      when '21' then v_has_21 := true;
      else
        raise exception 'Suratgarh race configuration must contain exactly the 5, 10 and 21 km categories';
    end case;
  end loop;

  if v_count <> 3 or not (v_has_5 and v_has_10 and v_has_21) then
    raise exception 'Suratgarh race configuration must contain exactly the 5, 10 and 21 km categories';
  end if;
end;
$$;

update public.race_config
set fee_paise = case race
  when '5' then 39900
  when '10' then 49900
  when '21' then 49900
end
where event_id = 'suratgarh-2026'
  and fee_paise is distinct from case race
    when '5' then 39900
    when '10' then 49900
    when '21' then 49900
  end;

commit;
