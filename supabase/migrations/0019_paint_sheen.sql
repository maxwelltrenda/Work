-- Paint colors get a sheen and whether they're for interior or exterior use.
alter table items add column if not exists sheen text
  check (sheen is null or sheen in ('Flat', 'Matte', 'Eggshell', 'Satin', 'Semi-Gloss', 'Gloss'));
alter table items add column if not exists paint_use text
  check (paint_use is null or paint_use in ('interior', 'exterior'));
