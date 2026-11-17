-- Paint locations: which paint goes where (from the Facilities Notion page
-- "Paint Colors | Locations"). Shown on the Paint page under "Where it goes".
-- Everyone who can see paint stock can read it; admins and the Maintenance
-- manager can add, change and remove rows.

create table if not exists paint_spots (
  id          bigint generated always as identity primary key,
  area        text not null check (trim(area) <> ''),
  spot        text not null check (trim(spot) <> ''),
  color       text,
  brand       text,
  base        text,
  sheen       text,
  notes       text,
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists paint_spots_area_idx on paint_spots (area, sort);

alter table paint_spots enable row level security;
drop policy if exists paint_spots_read on paint_spots;
create policy paint_spots_read on paint_spots for select to authenticated using (can_see_stock('paint'));
drop policy if exists paint_spots_write on paint_spots;
create policy paint_spots_write on paint_spots for all to authenticated using (can_use_pm()) with check (can_use_pm());
grant select, insert, update, delete on paint_spots to authenticated;

-- Starting list, copied from Notion (only if the table is empty).
insert into paint_spots (area, spot, color, brand, base, sheen, sort)
select * from (values
  ('South Hall', 'White walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 0),
  ('South Hall', 'Black Walls', 'Limousine Leather', 'Behr', null, 'Eggshell', 1),
  ('South Hall', 'Black Doors', 'Limousine Leather', 'Behr Ultra', null, 'Satin', 2),
  ('Family Center', 'Stage | Trim + Face', 'Limousine Leather', 'Behr', null, 'Eggshell', 3),
  ('Family Center', 'Baseboards', 'Limousine Leather', 'Behr', null, 'Eggshell', 4),
  ('Family Center', 'Sound Board', 'Limousine Leather', 'Behr', null, 'Eggshell', 5),
  ('Family Center', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 6),
  ('Executive Offices', 'PL | Blue Walls', 'Starless Night', 'Behr Ultra | Scuff Defense', 'Base 1723', 'Flat', 7),
  ('Executive Offices', 'PL | Grey Walls + Cabinets', null, null, null, null, 8),
  ('Executive Offices', 'PH | Grey Walls', 'Edgecomb Gray H (HC-173BM)', 'Behr Ultra', 'Base 3700', 'Satin', 9),
  ('Executive Offices', 'PV | Office', 'Fawn Brindle', 'Sherwin Williams', null, 'Eggshell', 10),
  ('Executive Offices', 'Bottom Half Hallway (Grey)', 'Peppercorn 7674', 'Sherwin Williams', null, 'Eggshell', 11),
  ('Executive Boardroom', 'Black Walls | Inside Doors', 'Black Magic', 'Behr Ultra | Scuff Defense', null, 'Flat', 12),
  ('Executive Boardroom', 'White Walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 13),
  ('Preschool Hallway', 'Tan Wall', '7029 | Agreeable Gray', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 14),
  ('Preschool Hallway', 'Purple Wall', 'Custom Color Match', 'Behr Premium Plus', 'Base 2300', 'Eggshell', 15),
  ('Preschool Hallway', 'Yellow Wall', 'M280-6 | Solid Gold', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 16),
  ('Preschool Hallway', 'Grey/Green Wall', 'Mountain Pine', 'Behr Premium Plus', 'Base 2300', 'Eggshell', 17),
  ('Preschool Hallway', 'White Walls', '7004 | Snowbound', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 18),
  ('Preschool Hallway', 'Green Wall', 'P420-5 | Shamrock Green', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 19),
  ('Preschool Hallway', 'Orange Wall', 'M170-6 | Dash of Curry', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 20),
  ('Preschool Hallway', 'Blue Wall', 'P460-6 | Paradise Landscape', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 21),
  ('Preschool Hallway', 'Outer Blue Wall', 'P470-4 | Paradise Sky', 'Sherwin Williams | ProMark 200', null, 'Eggshell', 22),
  ('Executive Offices', 'PL | Blue Walls', 'Cover the earth (sherwin)', 'Sherwin Williams', null, null, 23),
  ('Executive Offices', 'PL | Barber Room', 'Wrought iron', 'Sherwin Williams', null, null, 24),
  ('North Hall', 'North Wing Bathrooms | Top Half Walls', 'Snowbound', 'Behr', null, 'Eggshell', 25),
  ('North Hall', 'North Wing Bathrooms | Lower Half Walls', 'Iron Ore', 'Behr', null, 'Eggshell', 26),
  ('Sanctuary', 'Grand Lobby Bathrooms | Top Half Walls', 'Snowbound', 'Behr', null, 'Eggshell', 27),
  ('Sanctuary', 'Grand Lobby Bathrooms | Lower Half Walls', 'Iron Ore', 'Behr', null, 'Eggshell', 28),
  ('North Hall', 'White Doors', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 29),
  ('Sanctuary', 'Grand Lobby Bathrooms | Stalls', 'Limousine Leather', 'Behr', null, 'Eggshell', 30),
  ('Family Center Offices', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 31),
  ('Family Center Offices', 'Black Hand Rails in Stairways', 'Limousine Leather', 'Behr Ultra', null, 'Satin', 32),
  ('Exterior', 'White Walls', 'Snowbound', 'Behr', null, 'Flat', 33),
  ('Sanctuary', 'Black Walls', 'Limousine Leather', 'Behr', null, 'Eggshell', 34),
  ('South Hall', 'Conference Room C', 'Black Magic SW 6991', 'Behr Ultra | Scuff Defense', 'Base 1723', 'Flat', 35),
  ('Sanctuary', 'White Ceiling | Foyers', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 36),
  ('MC Central', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 37),
  ('South Offices', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 38),
  ('Preschool Hallway', 'Black Doors', 'Limousine Leather', 'Behr Ultra', null, 'Satin', 39),
  ('Chapel', 'White exterior door', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 40),
  ('Chapel', 'White walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 41),
  ('South Offices', 'Black Hand Rails in Stairways', 'Limousine Leather', 'Behr Ultra', null, 'Satin', 42),
  ('South Offices', 'White walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 43),
  ('South Offices', 'Conference Room C', 'Limousine Leather', 'Behr', null, 'Eggshell', 44),
  ('Offsite', 'Blue Walls', 'Sea Mariner SW 9640', 'Behr Marquee', null, 'Eggshell', 45),
  ('Offsite', 'Grey Walls', 'Porpoise SW 7047', 'Behr Marquee', null, 'Eggshell', 46),
  ('North Hall', 'White Walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 47),
  ('North Hall', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 48),
  ('North Hall', 'Black Walls', 'Limousine Leather', 'Behr Ultra', null, 'Eggshell', 49),
  ('Sanctuary', 'Front of Stage', 'Limousine Leather', 'Behr Ultra', 'Base 2753', 'Eggshell', 50),
  ('Sanctuary', 'Nursing Mother''s Room | Green Walls', 'Custom Color Match', 'Glidden Premium', 'Base GLN6213N', 'Satin', 51),
  ('Sanctuary', 'Shared Office | White Walls', 'Winter White', 'Behr Premium Plus', 'Base 2050', 'Eggshell', 52),
  ('Sanctuary', 'Balcony Railings', 'Limousine Leather', 'Behr Ultra | Scuff Defense', null, 'Satin', 53),
  ('Sanctuary', 'Worship Green Room | Walls', 'Custom Color Match', 'Behr Ultra | Scuff Defense', 'Base 1723', 'Flat', 54),
  ('Sanctuary', 'Media Room Walls', 'Limousine Leather', 'Behr Premium Plus', 'Base 1300', 'Flat', 55),
  ('Sanctuary', 'Hall | White Walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 56),
  ('Sanctuary', 'Black Doors', 'Limousine Leather', 'Behr Ultra | Scuff Defense', 'Deep Base 7753', 'Satin', 57),
  ('Sanctuary', 'Grey Walls', 'Iron Ore', 'Behr Pro E600', 'Deep Base PR613', 'Flat', 58),
  ('MC Central', 'Counters + Front Facing Flats', 'Golden Oak 2108', 'Minwax Stain Wood Finish', null, null, 59),
  ('MC Central', 'White Walls', 'Snowbound', 'Sherwin Williams', null, 'Eggshell', 60),
  ('MC Central', 'Black Walls', 'Limousine Leather', 'Behr', null, 'Eggshell', 61)
) v(area, spot, color, brand, base, sheen, sort)
where not exists (select 1 from paint_spots);
