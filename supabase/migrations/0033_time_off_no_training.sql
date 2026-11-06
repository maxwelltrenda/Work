-- Team schedule: "Training" is no longer a kind of time off.
alter table time_off drop constraint if exists time_off_kind_check;
alter table time_off add constraint time_off_kind_check check (kind in ('Day off', 'Vacation', 'Sick', 'Out of office', 'Other'));
