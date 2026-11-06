-- Team schedule: "Day off" is now "PTO", and "Out of office" is gone.
update time_off set kind = 'PTO' where kind = 'Day off';
update time_off set kind = 'Other' where kind = 'Out of office';
alter table time_off drop constraint if exists time_off_kind_check;
alter table time_off add constraint time_off_kind_check check (kind in ('PTO', 'Vacation', 'Sick', 'Other'));
