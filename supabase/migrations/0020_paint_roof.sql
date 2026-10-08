-- Paint use can also be roof.
alter table items drop constraint if exists items_paint_use_check;
alter table items add constraint items_paint_use_check
  check (paint_use is null or paint_use in ('interior', 'exterior', 'roof'));
