-- How many individual pieces one scanned unit holds (e.g. a box of paper
-- towels holds 6 rolls). Stock is still counted and scanned in boxes; the
-- app shows the total pieces as quantity × pack_size.
alter table items add column if not exists pack_size integer not null default 1;
alter table items add constraint items_pack_size_check check (pack_size >= 1);
